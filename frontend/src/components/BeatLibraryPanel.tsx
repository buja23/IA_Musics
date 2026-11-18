import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Music, Trash2, Download, Folder, PanelLeftClose } from 'lucide-react';
import { MidiFiles, ProcessBeatResponse, StemInfo } from '../types';

interface BeatItem {
  job_id: string;
  original_filename: string;
  created_at: string;
  metadata: { duration_seconds: number; bpm: number; key: string };
  stems: StemInfo[];
  midi_files: MidiFiles;
  analysis_url: string;
}

interface BeatLibraryPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  onSelectBeat: (beat: ProcessBeatResponse) => void;
  onOpenModal: () => void;
  stemsUrls?: Record<string, string>;
  midiFiles?: MidiFiles;
}

const BACKEND_URL = 'http://localhost:8000';

export const BeatLibraryPanel: React.FC<BeatLibraryPanelProps> = ({
  collapsed,
  onToggle,
  onSelectBeat,
  onOpenModal,
  stemsUrls,
  midiFiles,
}) => {
  const [beats, setBeats] = useState<BeatItem[]>([]);
  const [beatsOpen, setBeatsOpen] = useState(true);
  const [stemsOpen, setStemsOpen] = useState(true);
  const [midiOpen, setMidiOpen] = useState(true);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/v1/beats`)
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setBeats(Array.isArray(data) ? data : []))
      .catch(() => setBeats([]));
  }, []);

  const getUrl = (path: string) => path.startsWith('http') ? path : `${BACKEND_URL}${path.startsWith('/') ? '' : '/'}${path}`;

  const openBeat = (beat: BeatItem) => {
    onSelectBeat({
      job_id: beat.job_id,
      status: 'completed',
      processing_time_seconds: 0,
      stems: beat.stems,
      metadata: { duration: beat.metadata.duration_seconds, duration_seconds: beat.metadata.duration_seconds, bpm: beat.metadata.bpm, key: beat.metadata.key },
      analysis_url: beat.analysis_url,
      midi_files: beat.midi_files,
    });
  };

  const deleteBeat = async (jobId: string) => {
    if (!confirm(`Excluir o beat ${jobId}?`)) return;
    const response = await fetch(`${BACKEND_URL}/api/v1/beats/${jobId}`, { method: 'DELETE' });
    if (response.ok) setBeats((items) => items.filter((item) => item.job_id !== jobId));
  };

  if (collapsed) {
    return (
      <aside className="w-9 shrink-0 border-r border-[#121417] bg-[#282d33] flex flex-col items-center py-2">
        <button onClick={onToggle} className="h-7 w-7 grid place-items-center text-[#a7afb8] hover:text-[#76e068]" title="Abrir Browser">
          <FolderOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[230px] shrink-0 border-r border-[#121417] bg-[#282d33] flex flex-col overflow-hidden">
      <div className="h-8 border-b border-[#121417] px-2 flex items-center justify-between text-[11px] font-mono text-[#d1d5db]">
        <span className="flex items-center gap-1.5"><Folder className="h-3.5 w-3.5 text-[#ff7b00]" />BROWSER</span>
        <button onClick={onToggle} className="text-[#7e8791] hover:text-white" title="Recolher Browser"><PanelLeftClose className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 text-[10px] font-mono">
        <button onClick={() => setBeatsOpen((value) => !value)} className="w-full h-7 px-2 flex items-center gap-1 text-left text-[#d8dde3] hover:bg-[#323840]">
          {beatsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Beats Analisados
        </button>
        {beatsOpen && (
          <div className="pb-1">
            {beats.map((beat) => (
              <div key={beat.job_id} className="group flex items-center gap-1 px-2 py-1.5 hover:bg-[#323840]">
                <button onClick={() => openBeat(beat)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[#bfc6ce] group-hover:text-[#76e068]">{beat.original_filename}</div>
                  <div className="text-[9px] text-[#7e8791]">{beat.metadata.bpm} BPM · {beat.metadata.key}</div>
                </button>
                <button onClick={() => openBeat(beat)} title="Abrir beat" className="text-[#76e068] opacity-70 hover:opacity-100"><Music className="h-3 w-3" /></button>
                <button onClick={() => deleteBeat(beat.job_id)} title="Excluir beat" className="text-[#ef4444] opacity-60 hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            {beats.length === 0 && <button onClick={onOpenModal} className="px-5 py-2 text-[#7e8791] hover:text-[#76e068]">Abrir biblioteca...</button>}
          </div>
        )}

        <button onClick={() => setStemsOpen((value) => !value)} className="w-full h-7 px-2 flex items-center gap-1 text-left text-[#d8dde3] hover:bg-[#323840]">
          {stemsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Project Stems (.wav)
        </button>
        {stemsOpen && (
          <div className="pb-1">
            {Object.entries(stemsUrls || {}).map(([name, path]) => path && (
              <a key={name} href={getUrl(path)} download={`${name}.wav`} className="h-6 px-5 flex items-center gap-1.5 text-[#bfc6ce] hover:bg-[#323840] hover:text-white">
                <Download className="h-3 w-3 text-[#76e068]" />{name}.wav
              </a>
            ))}
          </div>
        )}

        <button onClick={() => setMidiOpen((value) => !value)} className="w-full h-7 px-2 flex items-center gap-1 text-left text-[#d8dde3] hover:bg-[#323840]">
          {midiOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          MIDI Scores (.mid)
        </button>
        {midiOpen && (
          <div>
            {midiFiles && ([
              ['Melody', midiFiles.melody],
              ['808 Bass', midiFiles.bass_808],
              ['Vocals', midiFiles.vocals],
            ] as const).map(([name, path]) => path && (
              <a key={name} href={getUrl(path)} download={`${name}.mid`} className="h-6 px-5 flex items-center gap-1.5 text-[#bfc6ce] hover:bg-[#323840] hover:text-white">
                <Download className="h-3 w-3 text-[#ff7b00]" />{name}.mid
              </a>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
