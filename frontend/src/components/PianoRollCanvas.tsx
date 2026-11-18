import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Layers, Activity, Music, Disc } from 'lucide-react';
import { NoteEvent, DrumMapping, BeatMetadata, EnergyEnvelopes } from '../types';

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
  const [xaiEnabled, setXaiEnabled] = useState<boolean>(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; note: NoteEvent; layer: string } | null>(null);
  const noteRectsRef = useRef<Array<{ x: number; y: number; w: number; h: number; note: NoteEvent; layer: string }>>([]);

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
    noteRectsRef.current = [];

    // Janela temporal visível centrada ou com playhead a 25% da tela
    const windowStart = Math.max(0, currentTime - zoomWindowSeconds * 0.25);
    const windowEnd = windowStart + zoomWindowSeconds;

    const pianoWidth = 44;
    const plotWidth = width - pianoWidth;
    const timeToX = (t: number) => {
      return pianoWidth + ((t - windowStart) / zoomWindowSeconds) * plotWidth;
    };

    const midiToY = (m: number) => {
      const clamped = Math.max(minMidi, Math.min(maxMidi, m));
      const row = maxMidi - clamped;
      return (row / totalMidiRows) * (height - 95);
    };

    const noteHeight = Math.max(4, (height - 90) / totalMidiRows);

    // 1. Limpar Fundo
    ctx.fillStyle = '#06090f';
    ctx.fillRect(0, 0, width, height);

    // 2. Grade rítmica alinhada a BPM e compassos de 4 tempos
    ctx.lineWidth = 1;
    const bpm = metadata?.bpm || 140;
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = secondsPerBeat * 4;
    const firstBeat = Math.floor(windowStart / secondsPerBeat) * secondsPerBeat;

    for (let t = firstBeat; t <= windowEnd; t += secondsPerBeat) {
      const x = timeToX(t);
      const isBar = Math.abs(t / secondsPerBar - Math.round(t / secondsPerBar)) < 0.001;
      ctx.strokeStyle = isBar ? '#334155' : '#1e293b';
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Régua lateral de piano fixa em 44px
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, pianoWidth, height);
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(pianoWidth, 0);
    ctx.lineTo(pianoWidth, height);
    ctx.stroke();

    const pitchNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const normalizedKey = metadata?.key?.trim().toUpperCase() ?? '';
    const keyName = normalizedKey.match(/[A-G](?:#|B)?/)?.[0].replace('DB', 'C#').replace('EB', 'D#').replace('GB', 'F#').replace('AB', 'G#').replace('BB', 'A#') ?? 'C';
    const keyPitch = pitchNames.indexOf(keyName);
    const isMinor = /MIN|MÍN/.test(normalizedKey);
    const scaleIntervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const scalePitches = new Set(scaleIntervals.map((interval) => (keyPitch >= 0 ? (keyPitch + interval) % 12 : interval)));

    // Linhas horizontais sutis para teclas pretas / brancas
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = midiToY(m);
      const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
      ctx.fillStyle = isBlack ? 'rgba(15, 23, 42, 0.55)' : 'rgba(30, 41, 59, 0.18)';
      ctx.fillRect(pianoWidth, y, plotWidth, noteHeight);

      const pitchName = pitchNames[m % 12];
      const isScaleNote = scalePitches.has(m % 12);
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, y, pianoWidth - 1, noteHeight);
      ctx.fillStyle = isScaleNote ? '#00f0ff' : '#64748b';
      ctx.font = '9px "JetBrains Mono"';
      if (m % 12 === 0) ctx.fillText(`C${Math.floor(m / 12) - 1}`, 5, y + noteHeight - 1);
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

        const confidence = Math.max(0.18, Math.min(1, n.velocity));
        ctx.fillStyle = `rgba(168, 85, 247, ${0.45 + confidence * 0.55})`;
        ctx.fillRect(x1, y, w, noteHeight - 1);
        ctx.strokeStyle = '#c084fc';
        ctx.strokeRect(x1, y, w, noteHeight - 1);
        noteRectsRef.current.push({ x: x1, y, w, h: noteHeight - 1, note: n, layer: 'Melodia' });
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

        const confidence = Math.max(0.18, Math.min(1, n.velocity));
        ctx.fillStyle = `rgba(244, 63, 94, ${0.45 + confidence * 0.55})`;
        ctx.fillRect(x1, y, w, noteHeight - 1);
        ctx.strokeStyle = '#fb7185';
        ctx.strokeRect(x1, y, w, noteHeight - 1);
        noteRectsRef.current.push({ x: x1, y, w, h: noteHeight - 1, note: n, layer: 'Vocais' });
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
        const confidence = Math.max(0.18, Math.min(1, n.velocity));
        ctx.fillStyle = `rgba(0, 240, 255, ${0.45 + confidence * 0.55})`;
        ctx.fillRect(x1, y, w, noteHeight - 1);
        ctx.strokeStyle = '#00f0ff';
        ctx.strokeRect(x1, y, w, noteHeight - 1);
        noteRectsRef.current.push({ x: x1, y, w, h: noteHeight - 1, note: n, layer: '808' });

        // Desenhar Curva de Pitch Bend (Glides)
        if (n.pitch_bend && n.pitch_bend.length > 1) {
          ctx.strokeStyle = '#00f0ff';
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
      const drumStartY = height - 95;

      // Divisor
      ctx.strokeStyle = '#1e2b45';
      ctx.beginPath();
      ctx.moveTo(0, drumStartY);
      ctx.lineTo(width, drumStartY);
      ctx.stroke();

      // 3 Linhas dedicadas: Kicks (linha 0), Snares/Claps (linha 1), Hi-Hats (linha 2)
      const drumTracks = [
        { label: 'KICK', hits: drums.kicks, color: '#f59e0b', y: drumStartY + 16 },
        { label: 'SNARE', hits: drums.snares_claps, color: '#00f0ff', y: drumStartY + 47 },
        { label: 'HI-HAT', hits: drums.hihats, color: '#10b981', y: drumStartY + 78 },
      ];

      drumTracks.forEach((track) => {
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(pianoWidth, track.y - 15);
        ctx.lineTo(width, track.y - 15);
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.font = '9px "JetBrains Mono"';
        ctx.fillText(track.label, 5, track.y + 3);

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
    xaiEnabled,
  ]);

  return (
    <div className="w-full bg-[#0f172a]/90 border border-slate-800/80 p-4 flex flex-col gap-3">
      {/* HUD de Notas Ativas e Métricas em Tempo Real */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
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

        <button
          onClick={() => setXaiEnabled((value) => !value)}
          className={`font-mono text-[10px] px-2 py-1 border rounded-sm ${xaiEnabled ? 'bg-[#10b981]/15 border-[#10b981] text-[#10b981]' : 'bg-[#16161a] border-zinc-700 text-zinc-500'}`}
        >
          [XAI: {xaiEnabled ? 'ON' : 'OFF'}]
        </button>
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
                ? 'text-zinc-100'
                : 'text-zinc-600'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#a855f7] mr-1.5" />Melodia
          </button>

          <button
            onClick={() => toggleLayer('bass_808')}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition-all cursor-pointer ${
              activeLayers.bass_808
                ? 'text-zinc-100'
                : 'text-zinc-600'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00f0ff] mr-1.5" />808
          </button>

          <button
            onClick={() => toggleLayer('vocals')}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition-all cursor-pointer ${
              activeLayers.vocals
                ? 'text-zinc-100'
                : 'text-zinc-600'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#f43f5e] mr-1.5" />Vocais
          </button>

          <button
            onClick={() => toggleLayer('drums')}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition-all cursor-pointer ${
              activeLayers.drums
                ? 'text-zinc-100'
                : 'text-zinc-600'
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10b981] mr-1.5" />Bateria
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
      <div className="w-full h-64 bg-[#06090f] border border-slate-800/80 overflow-hidden relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const hit = [...noteRectsRef.current].reverse().find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
            setTooltip(hit ? { x, y, note: hit.note, layer: hit.layer } : null);
          }}
          onMouseLeave={() => setTooltip(null)}
        />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 border border-slate-700 bg-[#0f172a]/95 px-2 py-1.5 text-[10px] font-mono text-zinc-200 shadow-xl"
            style={{ left: Math.min(tooltip.x + 10, 520), top: Math.max(tooltip.y - 54, 6) }}
          >
            <div className="text-cyan-300">{tooltip.layer} · {tooltip.note.note_name}</div>
            <div>Velocity {Math.round(tooltip.note.velocity * 127)}</div>
            {tooltip.note.pitch_bend?.length ? <div>Glide {(tooltip.note.pitch_bend[tooltip.note.pitch_bend.length - 1] ?? 0).toFixed(2)} st</div> : null}
          </div>
        )}
      </div>
    </div>
  );
};
