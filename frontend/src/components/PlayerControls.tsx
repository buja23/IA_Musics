import React from 'react';
import { Play, Pause, Repeat, SkipBack, Volume2 } from 'lucide-react';

interface PlayerControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  isLoop: boolean;
  onToggleLoop: () => void;
}

const formatTime = (secs: number) => {
  if (isNaN(secs) || secs < 0) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  isLoop,
  onToggleLoop,
}) => {
  return (
    <div className="w-full bg-[#06090f]/95 backdrop-blur-md border-t border-cyan-500/20 px-4 md:px-8 py-3.5 flex flex-col gap-2 shadow-2xl">
      {/* Barra de Progresso / Seek */}
      <div className="flex items-center gap-3 max-w-[1600px] w-full mx-auto">
        <span className="text-xs font-mono text-neon-cyan font-bold w-12 text-right">
          {formatTime(currentTime)}
        </span>

        <div className="relative flex-1 flex items-center group">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.05"
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full accent-neon-cyan h-2 bg-surface-highlight rounded-lg cursor-pointer transition-all"
          />
        </div>

        <span className="text-xs font-mono text-gray-400 w-12">
          {formatTime(duration)}
        </span>
      </div>

      {/* Botões de Ação Centralizados */}
      <div className="flex items-center justify-between max-w-[1600px] w-full mx-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSeek(0)}
            className="p-2 rounded-lg bg-surface-highlight hover:bg-neon-cyan/10 border border-surface-border hover:border-neon-cyan/40 text-gray-300 hover:text-neon-cyan transition-all cursor-pointer"
            title="Voltar ao início"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={onToggleLoop}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              isLoop
                ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan shadow-cyan-glow'
                : 'bg-surface-highlight border-surface-border text-gray-400 hover:text-white'
            }`}
            title={isLoop ? 'Loop Ativo' : 'Ativar Loop'}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Play / Pause Principal */}
        <button
          onClick={onTogglePlay}
          className="w-12 h-12 rounded-full bg-neon-cyan hover:bg-cyan-300 text-black flex items-center justify-center font-bold shadow-cyan-glow hover:scale-105 active:scale-95 transition-all cursor-pointer"
          title={isPlaying ? 'Pausar' : 'Reproduzir'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-black" />
          ) : (
            <Play className="w-5 h-5 fill-black ml-0.5" />
          )}
        </button>

        <div className="w-24 text-right">
          <span className="text-[10px] font-mono text-gray-400 bg-surface-highlight px-2 py-1 rounded border border-surface-border">
            {isPlaying ? '● PLAYING' : '❚❚ PAUSED'}
          </span>
        </div>
      </div>
    </div>
  );
};
