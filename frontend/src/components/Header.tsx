import React, { useEffect, useState } from 'react';
import { Play, Pause, Square, Repeat, RotateCcw, Library, Grid3X3, Box, Piano } from 'lucide-react';

interface HeaderProps {
  hasTrack: boolean;
  onReset: () => void;
  onOpenLibrary: () => void;
  bpm?: number;
  keySignature?: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  isLoop: boolean;
  onToggleLoop: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  getFrequencyData: () => Uint8Array;
  activeTab: 'both' | 'visual' | 'pianoroll';
  onActiveTabChange: (tab: 'both' | 'visual' | 'pianoroll') => void;
}

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const Header: React.FC<HeaderProps> = ({
  hasTrack, onReset, onOpenLibrary, bpm, keySignature,
  isPlaying, onTogglePlay, onStop, isLoop, onToggleLoop,
  currentTime, duration, onSeek, getFrequencyData, activeTab, onActiveTabChange,
}) => {
  const [peak, setPeak] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const data = getFrequencyData();
      let max = 0;
      for (let i = 0; i < data.length; i++) max = Math.max(max, data[i]);
      setPeak(max / 255);
    }, 50);
    return () => window.clearInterval(timer);
  }, [getFrequencyData]);

  const toolButton = (active: boolean) => `h-7 px-2 border border-[#121417] flex items-center gap-1.5 text-[10px] font-mono ${active ? 'bg-[#3a414a] text-[#76e068]' : 'bg-[#323840] text-[#aeb5bd] hover:text-white'}`;
  return (
    <header className="h-[52px] shrink-0 bg-[#282d33] border-b border-[#121417] flex items-center px-2 gap-2 overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 border-r border-[#121417] pr-2 h-9">
        <div className="h-8 px-2 border border-[#121417] bg-[#323840] flex items-center"><span className="text-[12px] font-black tracking-wide text-[#e8edf2]">TRAP<span className="text-[#ff7b00]"> AI</span></span></div>
        {hasTrack && <button onClick={onReset} className="h-8 px-2 flex items-center gap-1.5 bg-[#323840] border border-[#121417] text-[10px] text-[#d0d5da] hover:text-[#ff7b00]" title="Novo Beat"><RotateCcw className="h-3.5 w-3.5" /><span className="hidden xl:inline">Novo Beat</span></button>}
        <button onClick={onOpenLibrary} className="h-8 px-2 flex items-center gap-1.5 bg-[#323840] border border-[#121417] text-[10px] text-[#d0d5da] hover:text-[#76e068]" title="Biblioteca"><Library className="h-3.5 w-3.5" /><span className="hidden xl:inline">Biblioteca</span></button>
      </div>

      <div className="shrink-0 flex items-center gap-1">
        <button onClick={onTogglePlay} className="h-8 w-8 grid place-items-center bg-[#323840] border border-[#121417] text-[#76e068] hover:bg-[#3a414a]" title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}</button>
        <button onClick={onStop} className="h-8 w-8 grid place-items-center bg-[#323840] border border-[#121417] text-[#d5dae0] hover:text-[#ef4444]" title="Stop"><Square className="h-3.5 w-3.5 fill-current" /></button>
        <button onClick={onToggleLoop} className={`h-8 w-8 grid place-items-center border border-[#121417] ${isLoop ? 'bg-[#4b4f32] text-[#f59e0b]' : 'bg-[#323840] text-[#aeb5bd]'}`} title="Loop"><Repeat className="h-4 w-4" /></button>
      </div>

      <input type="range" min="0" max={duration || 100} step="0.05" value={currentTime} onChange={(event) => onSeek(parseFloat(event.target.value))} disabled={!hasTrack} className="w-28 xl:w-44 min-w-16 accent-[#ff7b00] h-2 cursor-pointer" aria-label="Timeline seek" />

      <div className="h-9 min-w-[330px] flex-1 max-w-[520px] bg-[#131619] border border-[#121417] px-2 flex items-center gap-3 shadow-[inset_0_0_0_1px_#3a414a]">
        <div className="text-[11px] font-mono text-[#76e068] whitespace-nowrap">{formatTime(currentTime)} <span className="text-[#ff7b00]">/ {formatTime(duration)}</span></div>
        <div className="h-5 border-l border-[#323840]" />
        <div className="text-[11px] font-mono text-[#76e068] whitespace-nowrap">{bpm ? bpm.toFixed(1) : '---'} <span className="text-[#7e8791]">BPM</span></div>
        <div className="text-[11px] font-mono text-[#76e068] truncate">{keySignature || '---'}</div>
        <div className="ml-auto w-20 h-[6px] bg-[#282d33] border border-[#121417] overflow-hidden"><div className="h-full bg-gradient-to-r from-[#76e068] via-[#f59e0b] to-[#ef4444] transition-[width] duration-75" style={{ width: `${peak * 100}%` }} /></div>
      </div>

      <div className="shrink-0 ml-auto flex items-center gap-1">
        <button onClick={() => onActiveTabChange('both')} className={toolButton(activeTab === 'both')}><Grid3X3 className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Completa</span></button>
        <button onClick={() => onActiveTabChange('visual')} className={toolButton(activeTab === 'visual')}><Box className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">ZGameEditor</span></button>
        <button onClick={() => onActiveTabChange('pianoroll')} className={toolButton(activeTab === 'pianoroll')}><Piano className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Piano Roll</span></button>
      </div>
    </header>
  );
};
