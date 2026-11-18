import React from 'react';
import { Activity, RotateCcw, Library } from 'lucide-react';

interface HeaderProps {
  hasTrack: boolean;
  onReset: () => void;
  onOpenLibrary: () => void;
  bpm?: number;
  keySignature?: string;
}

export const Header: React.FC<HeaderProps> = ({
  hasTrack,
  onReset,
  onOpenLibrary,
  bpm,
  keySignature,
}) => {
  return (
    <header className="w-full bg-[#0f172a]/95 border-b border-slate-800/80 px-5 py-2 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-sm bg-[#16161a] border border-zinc-700 flex items-center justify-center">
          <Activity className="w-5 h-5 text-neon-cyan animate-pulse" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-wider text-white flex items-center gap-2">
            TRAP <span className="text-neon-cyan font-black">AI STUDIO</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30">
              v2.0 MIR
            </span>
          </h1>
          <p className="text-xs text-gray-400">
            Stem Splitter & Reactive 3D Visualizer
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {hasTrack && (
          <div className="hidden md:flex items-center gap-3 px-3 py-1 border-l border-slate-800/80 text-xs">
            {bpm && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">BPM:</span>
                <span className="text-neon-cyan font-bold">{bpm}</span>
              </div>
            )}
            {keySignature && (
              <div className="flex items-center gap-1.5 border-l border-surface-border pl-3">
                <span className="text-gray-400">TOM:</span>
                <span className="text-neon-pink font-bold">{keySignature}</span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onOpenLibrary}
          className="flex items-center gap-1.5 text-xs bg-surface-highlight hover:bg-neon-cyan/20 text-gray-300 hover:text-neon-cyan px-3 py-1.5 rounded border border-surface-border hover:border-neon-cyan/50 transition-all cursor-pointer"
          title="Abrir biblioteca de beats salvos"
        >
          <Library className="w-3.5 h-3.5 text-neon-cyan" />
          <span>Biblioteca</span>
        </button>

        {hasTrack && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs bg-surface-highlight hover:bg-neon-cyan/20 text-gray-300 hover:text-neon-cyan px-3 py-1.5 rounded border border-surface-border hover:border-neon-cyan/50 transition-all cursor-pointer"
            title="Processar outro beat"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Novo Beat</span>
          </button>
        )}
      </div>
    </header>
  );
};
